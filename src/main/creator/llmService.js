/**
 * LLM Service for lyrics correction
 * Supports OpenAI, Anthropic Claude, Google Gemini, and local LM Studio
 * Pure Node.js implementation
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLM_DEFAULTS } from '../../shared/defaults.js';

/**
 * Get LLM provider instance based on settings
 */
function getLLMProvider(settings) {
  const { provider, apiKey, baseUrl } = settings;

  switch (provider) {
    case 'anthropic':
      if (!apiKey) throw new Error('Anthropic API key required');
      return new Anthropic({ apiKey });

    case 'openai':
      if (!apiKey) throw new Error('OpenAI API key required');
      return new OpenAI({ apiKey });

    case 'gemini':
      if (!apiKey) throw new Error('Gemini API key required');
      return new GoogleGenerativeAI(apiKey);

    case 'lmstudio':
      // LM Studio uses OpenAI-compatible API
      return new OpenAI({
        apiKey: 'lm-studio', // dummy key
        baseURL: baseUrl || 'http://localhost:1234/v1',
      });

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Correct lyrics using LLM
 * @param {Object} whisperOutput - Output from Whisper (words array)
 * @param {string} referenceLyrics - Reference lyrics from LRCLIB
 * @param {Object} settings - LLM settings (provider, model, apiKey, etc.)
 * @returns {Object} Corrected lyrics with same structure as Whisper output
 */
export async function correctLyrics(whisperOutput, referenceLyrics, settings) {
  if (!settings.enabled) {
    console.log('🤖 LLM correction disabled, using Whisper output as-is');
    return {
      output: whisperOutput,
      stats: null,
    };
  }

  if (!referenceLyrics || !referenceLyrics.trim()) {
    console.log('🤖 No reference lyrics provided, skipping LLM correction');
    return {
      output: whisperOutput,
      stats: null,
    };
  }

  console.log(`🤖 Starting LLM lyrics correction with ${settings.provider}...`);

  try {
    const provider = getLLMProvider(settings);
    const llmResponse = await callLLM(provider, settings, whisperOutput, referenceLyrics);

    // Parse JSON response and apply corrections
    const {
      lines: correctedLines,
      corrections,
      missingLines,
    } = parseCorrection(llmResponse, whisperOutput);

    console.log(`✅ LLM correction complete (${corrections.length} lines changed)`);
    if (missingLines.length > 0) {
      console.log(`📝 LLM suggested ${missingLines.length} missing lines`);
    }

    return {
      output: {
        ...whisperOutput,
        lines: correctedLines,
      },
      stats: {
        corrections_applied: corrections.length,
        suggestions_made: corrections.length + missingLines.length, // Total suggestions (applied + not applied)
        corrections_rejected: 0, // We auto-apply all matching corrections
        missing_lines_suggested: missingLines.length,
        corrections: corrections, // Detailed correction list (applied)
        missing_lines: missingLines, // Detailed missing lines list (suggestions not applied)
        failed: false,
        provider: settings.provider,
        model: settings.model,
      },
    };
  } catch (error) {
    console.error('❌ LLM correction failed:', error.message);
    console.log('⚠️ Falling back to original Whisper output');
    return {
      output: whisperOutput,
      stats: {
        corrections_applied: 0,
        suggestions_made: 0,
        corrections_rejected: 0,
        missing_lines_suggested: 0,
        corrections: [],
        missing_lines: [],
        failed: true,
        error: error.message,
        provider: settings.provider,
        model: settings.model,
      },
    };
  }
}

/**
 * Call LLM API with lyrics correction prompt
 */
async function callLLM(provider, settings, whisperOutput, referenceLyrics) {
  const { provider: providerType, model } = settings;

  // Build structured line data for LLM (work with lines, not words)
  const lineData = whisperOutput.lines.map((line, i) => ({
    line_num: i + 1,
    text: line.text || '',
    start: line.start,
    end: line.end,
  }));

  // Build prompt
  const systemPrompt = `You are an automated speech recognition (ASR) error correction specialist. You fix technical errors from speech-to-text systems while preserving the original transcription structure. Return ONLY valid JSON.`;

  const userPrompt = `AUTOMATED SPEECH RECOGNITION (ASR) ERROR CORRECTION TASK

CONTEXT: You are correcting errors from Whisper AI that transcribed sung vocals. The system sometimes mishears words due to singing pronunciation, background music, and audio quality.

YOUR TASK: Fix ONLY obvious speech recognition errors where the ASR clearly misheard spoken/sung words.

REFERENCE TEXT (for identifying ASR mishearings - DO NOT copy verbatim):
${referenceLyrics}

ASR OUTPUT TO CORRECT (song lines with timing):
${JSON.stringify(lineData, null, 2)}

CRITICAL RULES:
1. ONLY correct obvious phonetic mishearings where automated speech recognition failed
2. DO NOT substitute entire phrases even if they don't match the reference
3. ONLY fix clear technical errors (e.g., "foamy" → "for me", "sancti" → "sanity")
4. When in doubt, DO NOT fix - leave the line unchanged
5. Return ONLY valid JSON, no markdown, no explanations

RESPONSE FORMAT (MUST BE VALID JSON):
{
  "corrections": [
    {"line_num": 1, "old_text": "original line", "new_text": "corrected line"}
  ],
  "missing_lines": [
    {
      "suggested_text": "Text of missing line from reference",
      "start": 15.5,
      "end": 19.5,
      "confidence": "high|medium|low",
      "reason": "Why this line is likely missing (e.g., 'Large gap in timing', 'Reference shows chorus missing')"
    }
  ]
}

IMPORTANT ABOUT MISSING LINES:
- ONLY suggest missing lines if you have strong evidence:
  1. Large timing gaps between transcribed lines (>4 seconds)
  2. Reference lyrics having content that clearly fits in gaps
- Set confidence based on evidence strength
- DO NOT invent lyrics - only use what's in the reference
- Return ONLY valid JSON, no markdown blocks, no additional text`;

  // Call appropriate API
  if (providerType === 'anthropic') {
    const response = await provider.messages.create({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return response.content[0].text;
  } else if (providerType === 'openai' || providerType === 'lmstudio') {
    const response = await provider.chat.completions.create({
      model: model || 'gpt-4o',
      temperature: 0.1,
      max_tokens: 16384,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return response.choices[0].message.content;
  } else if (providerType === 'gemini') {
    const genModel = provider.getGenerativeModel({
      model: model || 'gemini-2.0-flash-exp',
    });
    const result = await genModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4000,
      },
    });
    return result.response.text();
  }

  throw new Error(`Unsupported provider: ${providerType}`);
}

/**
 * Parse LLM JSON response and apply corrections to lines
 * Preserves timing information from original Whisper output
 * @returns {Object} { lines: correctedLines[], corrections: [], missingLines: [] }
 */
function parseCorrection(llmResponse, originalOutput) {
  // Parse JSON response
  let responseData;
  try {
    // Try to parse as-is
    responseData = JSON.parse(llmResponse);
  } catch {
    // Try to extract JSON from markdown blocks
    let cleaned = llmResponse.trim();
    if (cleaned.includes('```json')) {
      cleaned = cleaned.split('```json')[1].split('```')[0];
    } else if (cleaned.includes('```')) {
      cleaned = cleaned.split('```')[1].split('```')[0];
    }

    // Try to extract just the JSON object
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
    }

    try {
      responseData = JSON.parse(cleaned);
    } catch (e2) {
      console.error('Failed to parse LLM JSON response:', e2);
      console.error('Response:', llmResponse.substring(0, 500));
      throw new Error(`Invalid JSON response from LLM: ${e2.message}`);
    }
  }

  const corrections = responseData.corrections || [];
  const missingLines = responseData.missing_lines || [];

  // Apply corrections to lines
  const originalLines = originalOutput.lines || [];
  const correctedLines = [...originalLines];
  const appliedCorrections = [];

  for (const correction of corrections) {
    const lineNum = correction.line_num;
    const oldText = correction.old_text || '';
    const newText = correction.new_text || '';

    const lineIdx = lineNum - 1;
    if (lineIdx >= 0 && lineIdx < correctedLines.length) {
      const originalLine = originalLines[lineIdx];
      const originalText = originalLine.text || '';

      // Only apply if old_text matches exactly
      if (oldText === originalText && newText && newText !== originalText) {
        correctedLines[lineIdx] = {
          ...originalLine,
          text: newText,
        };

        appliedCorrections.push({
          line_num: lineNum,
          old_text: oldText,
          new_text: newText,
        });
      }
    }
  }

  return {
    lines: correctedLines,
    corrections: appliedCorrections,
    missingLines: missingLines,
  };
}

/**
 * Get LLM settings from app settings
 * Uses unified defaults from shared/defaults.js
 */
export function getLLMSettings(settingsManager) {
  const llmConfig = settingsManager.get('creator.llm', {});
  const apiKey = llmConfig.apiKey || LLM_DEFAULTS.apiKey;

  // SECURITY FIX (#25): Mask API key - only show last 4 chars to renderer
  const maskedApiKey = apiKey && apiKey.length > 8 ? `${'•'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}` : apiKey ? '••••••••' : '';

  return {
    enabled: llmConfig.enabled ?? LLM_DEFAULTS.enabled,
    provider: llmConfig.provider || LLM_DEFAULTS.provider,
    model: llmConfig.model || getDefaultModel(llmConfig.provider),
    apiKey: maskedApiKey,
    hasApiKey: Boolean(apiKey), // Let renderer know if key is set
    baseUrl: llmConfig.baseUrl || LLM_DEFAULTS.baseUrl,
  };
}

/**
 * Save LLM settings
 */
export function saveLLMSettings(settingsManager, llmSettings) {
  settingsManager.set('creator.llm', llmSettings);
}

/**
 * Get default model for a provider
 */
function getDefaultModel(provider) {
  const defaults = {
    anthropic: 'claude-3-5-sonnet-20241022',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash-exp',
    lmstudio: 'local-model',
  };
  return defaults[provider] || 'gpt-4o';
}

/**
 * Test LLM connection
 */
export async function testLLMConnection(settings) {
  try {
    const provider = getLLMProvider(settings);

    // Send simple test message
    const testPrompt = 'Reply with just the word "OK"';

    if (settings.provider === 'anthropic') {
      await provider.messages.create({
        model: settings.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: testPrompt }],
      });
    } else if (settings.provider === 'openai' || settings.provider === 'lmstudio') {
      await provider.chat.completions.create({
        model: settings.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: testPrompt }],
      });
    } else if (settings.provider === 'gemini') {
      const genModel = provider.getGenerativeModel({ model: settings.model });
      await genModel.generateContent(testPrompt);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

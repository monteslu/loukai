/**
 * EffectsPanelWrapper - State management wrapper for shared EffectsPanel
 * Loads effects directly from butterchurnPresets (like vanilla effects.js did)
 */

import { useState, useEffect, useCallback } from 'react';
import { EffectsPanel } from '../../shared/components/EffectsPanel.jsx';

export function EffectsPanelWrapper({ bridge }) {
  const [effects, setEffects] = useState([]);
  const [currentEffect, setCurrentEffect] = useState([]);
  const [disabledEffects, setDisabledEffects] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentCategory, setCurrentCategory] = useState('all');

  // Wrap functions in useCallback to prevent recreating them on every render
  const loadEffects = useCallback(() => {
    try {
      if (
        !window.butterchurnPresets ||
        typeof window.butterchurnPresets.getPresets !== 'function'
      ) {
        console.error('Butterchurn presets not available');
        return;
      }

      const presets = window.butterchurnPresets.getPresets();
      const parseMetadata = (name) => {
        let author = 'Unknown';
        let displayName = name;
        let category = 'other';

        if (name.includes(' - ')) {
          const parts = name.split(' - ');
          if (parts.length >= 2) {
            author = parts[0].trim();
            displayName = parts.slice(1).join(' - ').trim();
          }
        }

        const nameLower = name.toLowerCase();
        if (nameLower.includes('geiss') || author.toLowerCase().includes('geiss')) {
          category = 'geiss';
        } else if (nameLower.includes('martin') || author.toLowerCase().includes('martin')) {
          category = 'martin';
        } else if (nameLower.includes('flexi') || author.toLowerCase().includes('flexi')) {
          category = 'flexi';
        } else if (nameLower.includes('shifter') || author.toLowerCase().includes('shifter')) {
          category = 'shifter';
        }

        return { author, displayName, category };
      };

      const effectsList = Object.keys(presets).map((name) => {
        const metadata = parseMetadata(name);
        return {
          name,
          displayName: metadata.displayName,
          author: metadata.author,
          category: metadata.category,
          preset: presets[name],
        };
      });

      console.log('🎨 Loaded', effectsList.length, 'Butterchurn presets');
      setEffects(effectsList);
    } catch (error) {
      console.error('Failed to load effects:', error);
    }
  }, []);

  const loadDisabledEffects = useCallback(async () => {
    try {
      const waveformPrefs = await bridge.getWaveformPreferences();
      if (waveformPrefs?.disabledEffects) {
        setDisabledEffects(waveformPrefs.disabledEffects);
      }
    } catch (error) {
      console.error('Failed to load disabled effects:', error);
    }
  }, [bridge]);

  const selectEffect = useCallback(
    async (effectName) => {
      const preset = effects.find((e) => e.name === effectName);
      if (!preset) return;

      setCurrentEffect(effectName);

      // Apply effect to Butterchurn directly
      try {
        if (window.app?.player?.karaokeRenderer) {
          window.app.player.karaokeRenderer.switchToPreset(effectName, 2.0);
        }
      } catch (error) {
        console.error('Failed to apply effect to Butterchurn:', error);
      }

      // Notify main process for state management via bridge
      try {
        await bridge.selectEffect(effectName);
      } catch (error) {
        console.error('Failed to notify main process:', error);
      }
    },
    [effects, bridge]
  );

  const randomEffect = useCallback(() => {
    const enabledEffects = effects.filter((e) => !disabledEffects.includes(e.name));
    if (enabledEffects.length === 0) return;

    const randomIndex = Math.floor(Math.random() * enabledEffects.length);
    const randomEffect = enabledEffects[randomIndex];
    selectEffect(randomEffect.name);
  }, [effects, disabledEffects, selectEffect]);

  const enableEffect = useCallback(
    async (effectName) => {
      const updated = disabledEffects.filter((e) => e !== effectName);
      setDisabledEffects(updated);

      // Save to settings via bridge
      try {
        await bridge.enableEffect(effectName);
      } catch (error) {
        console.error('Failed to enable effect:', error);
      }
    },
    [disabledEffects, bridge]
  );

  const disableEffect = useCallback(
    async (effectName) => {
      const updated = [...disabledEffects, effectName];
      setDisabledEffects(updated);

      // Save to settings via bridge
      try {
        await bridge.disableEffect(effectName);
      } catch (error) {
        console.error('Failed to disable effect:', error);
      }
    },
    [disabledEffects, bridge]
  );

  useEffect(() => {
    loadEffects();
    loadDisabledEffects();
  }, [loadEffects, loadDisabledEffects]);

  // Respond to IPC requests for effects list (for web admin API)
  useEffect(() => {
    if (!window.kaiAPI?.events) return;

    const handleGetEffectsList = () => {
      // Strip out preset data (not serializable) - only send metadata
      const serializableEffects = effects.map((e) => ({
        name: e.name,
        displayName: e.displayName,
        author: e.author,
        category: e.category,
      }));

      window.kaiAPI.renderer.sendEffectsList(serializableEffects);
    };

    const handleGetCurrentEffect = () => {
      window.kaiAPI.renderer.sendCurrentEffect(currentEffect);
    };

    const handleGetDisabledEffects = () => {
      window.kaiAPI.renderer.sendDisabledEffects(disabledEffects);
    };

    window.kaiAPI.events.on('effects:getList', handleGetEffectsList);
    window.kaiAPI.events.on('effects:getCurrent', handleGetCurrentEffect);
    window.kaiAPI.events.on('effects:getDisabled', handleGetDisabledEffects);

    return () => {
      window.kaiAPI.events.removeListener('effects:getList', handleGetEffectsList);
      window.kaiAPI.events.removeListener('effects:getCurrent', handleGetCurrentEffect);
      window.kaiAPI.events.removeListener('effects:getDisabled', handleGetDisabledEffects);
    };
  }, [effects, currentEffect, disabledEffects]);

  // Listen for effects commands from web admin
  useEffect(() => {
    if (!window.kaiAPI?.events || effects.length === 0) return;

    const onSelectFromAdmin = (event, effectName) => {
      selectEffect(effectName);
    };

    const onNextFromAdmin = () => {
      const enabledEffects = effects.filter((e) => !disabledEffects.includes(e.name));
      if (enabledEffects.length === 0) return;

      const currentIndex = enabledEffects.findIndex((e) => e.name === currentEffect);
      const nextIndex = (currentIndex + 1) % enabledEffects.length;
      selectEffect(enabledEffects[nextIndex].name);
    };

    const onPreviousFromAdmin = () => {
      const enabledEffects = effects.filter((e) => !disabledEffects.includes(e.name));
      if (enabledEffects.length === 0) return;

      const currentIndex = enabledEffects.findIndex((e) => e.name === currentEffect);
      const prevIndex = currentIndex <= 0 ? enabledEffects.length - 1 : currentIndex - 1;
      selectEffect(enabledEffects[prevIndex].name);
    };

    const onRandomFromAdmin = () => {
      randomEffect();
    };

    const onDisableFromAdmin = (event, effectName) => {
      disableEffect(effectName);
    };

    const onEnableFromAdmin = (event, effectName) => {
      enableEffect(effectName);
    };

    window.kaiAPI.events.on('effects:select', onSelectFromAdmin);
    window.kaiAPI.events.on('effects:next', onNextFromAdmin);
    window.kaiAPI.events.on('effects:previous', onPreviousFromAdmin);
    window.kaiAPI.events.on('effects:random', onRandomFromAdmin);
    window.kaiAPI.events.on('effects:disable', onDisableFromAdmin);
    window.kaiAPI.events.on('effects:enable', onEnableFromAdmin);

    return () => {
      window.kaiAPI.events.removeListener('effects:select', onSelectFromAdmin);
      window.kaiAPI.events.removeListener('effects:next', onNextFromAdmin);
      window.kaiAPI.events.removeListener('effects:previous', onPreviousFromAdmin);
      window.kaiAPI.events.removeListener('effects:random', onRandomFromAdmin);
      window.kaiAPI.events.removeListener('effects:disable', onDisableFromAdmin);
      window.kaiAPI.events.removeListener('effects:enable', onEnableFromAdmin);
    };
  }, [
    effects,
    currentEffect,
    disabledEffects,
    selectEffect,
    randomEffect,
    disableEffect,
    enableEffect,
  ]);

  return (
    <EffectsPanel
      effects={effects}
      currentEffect={currentEffect}
      disabledEffects={disabledEffects}
      searchTerm={searchTerm}
      currentCategory={currentCategory}
      onSearch={setSearchTerm}
      onCategoryChange={setCurrentCategory}
      onSelectEffect={selectEffect}
      onRandomEffect={randomEffect}
      onEnableEffect={enableEffect}
      onDisableEffect={disableEffect}
    />
  );
}

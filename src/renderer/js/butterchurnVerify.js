/**
 * butterchurnVerify.js
 * Verifies Butterchurn libraries loaded correctly and checks WebGL compatibility
 * This runs early in the app lifecycle to catch any issues
 */

export function verifyButterchurn() {
  console.log('Butterchurn libraries loaded:', {
    butterchurn: typeof window.butterchurn,
    presets: typeof window.butterchurnPresets,
  });

  // Verify presets are available and debug butterchurn structure
  if (window.butterchurnPresets && typeof window.butterchurnPresets.getPresets === 'function') {
    const presets = window.butterchurnPresets.getPresets();
    console.log(
      'SUCCESS: Butterchurn loaded with',
      Object.keys(presets).length,
      'presets available'
    );
  } else {
    console.error('FAILED: Butterchurn presets not properly loaded');
    return false;
  }

  // WebGL compatibility test
  try {
    const testCanvas = document.createElement('canvas');
    const testGL = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    console.log('WebGL context test:', {
      hasWebGL: Boolean(testGL),
      version: testGL ? testGL.getParameter(testGL.VERSION) : 'none',
      renderer: testGL ? testGL.getParameter(testGL.RENDERER) : 'none',
    });

    if (!testGL) {
      console.error('FAILED: WebGL not available - Butterchurn effects will not work');
      return false;
    }
  } catch (e) {
    console.error('WebGL test error:', e);
    return false;
  }

  return true;
}

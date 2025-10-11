/**
 * EffectsPanel - Unified effects browser and control panel
 *
 * Based on renderer's effects design (grid layout with categories)
 * Works with both ElectronBridge and WebBridge via callbacks
 */

export function EffectsPanel({
  effects = [],
  currentEffect = null,
  disabledEffects = [],
  searchTerm = '',
  currentCategory = 'all',
  onSearch,
  onCategoryChange,
  onSelectEffect,
  onRandomEffect,
  onEnableEffect,
  onDisableEffect,
}) {
  // Filter effects based on category and search
  let filteredEffects = [...effects];

  if (currentCategory !== 'all') {
    filteredEffects = filteredEffects.filter((effect) => effect.category === currentCategory);
  }

  if (searchTerm.trim()) {
    const searchLower = searchTerm.toLowerCase();
    filteredEffects = filteredEffects.filter(
      (effect) =>
        effect.name?.toLowerCase().includes(searchLower) ||
        effect.displayName?.toLowerCase().includes(searchLower) ||
        effect.author?.toLowerCase().includes(searchLower)
    );
  }

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'geiss', label: 'Geiss' },
    { id: 'martin', label: 'Martin' },
    { id: 'flexi', label: 'Flexi' },
    { id: 'shifter', label: 'Shifter' },
    { id: 'other', label: 'Other' },
  ];

  const sanitizeFilename = (name) => {
    return name.replace(/[^a-zA-Z0-9-_\s]/g, '_');
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-blue-500"
            placeholder="Search effects..."
            value={searchTerm}
            onChange={(e) => onSearch && onSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4 text-gray-600 dark:text-gray-400">
          <span id="effectsCount" className="text-sm">
            {currentCategory === 'all' && !searchTerm.trim()
              ? `${effects.length} effects`
              : `${filteredEffects.length} of ${effects.length} effects`}
          </span>
          {onRandomEffect && (
            <button
              onClick={onRandomEffect}
              className="px-4 py-2 bg-blue-600 border-none rounded text-white cursor-pointer text-sm transition-colors flex items-center gap-1.5 hover:bg-blue-700"
            >
              <span className="material-icons text-lg">casino</span>
              Random
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-2.5 px-4 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex gap-2.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`px-3 py-1.5 rounded text-xs cursor-pointer transition-all ${currentCategory === cat.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white'}`}
              onClick={() => onCategoryChange && onCategoryChange(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filteredEffects.length === 0 ? (
            <div className="text-center p-10 text-gray-500 dark:text-gray-400 flex flex-col items-center">
              <span className="material-icons text-5xl mb-2.5">search_off</span>
              <div className="text-base">No effects found</div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {filteredEffects.map((effect) => {
                const isActive = currentEffect === effect.name;
                const isDisabled = disabledEffects.includes(effect.name);
                const sanitizedName = sanitizeFilename(effect.name);
                const screenshotPath = `../../static/images/butterchurn-screenshots/${sanitizedName}.png`;

                return (
                  <div
                    key={effect.name}
                    className={`rounded-md p-0 cursor-pointer transition-all overflow-hidden flex flex-col ${isActive ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-600' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-600'} ${isDisabled ? 'opacity-60' : ''}`}
                    onClick={() => !isDisabled && onSelectEffect && onSelectEffect(effect.name)}
                  >
                    <div className="relative w-full h-[150px] bg-gray-200 dark:bg-gray-900 overflow-hidden">
                      <img
                        src={screenshotPath}
                        alt={effect.displayName}
                        className="w-full h-full object-cover transition-transform hover:scale-105"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextElementSibling.style.display = 'flex';
                        }}
                      />
                      <div className="absolute top-0 left-0 w-full h-full hidden items-center justify-center bg-gray-200 dark:bg-gray-900 text-gray-400 dark:text-gray-600">
                        <span className="material-icons text-5xl">image_not_supported</span>
                      </div>
                    </div>
                    <div className={`p-4 flex-1 ${isDisabled ? 'opacity-60' : ''}`}>
                      <div className="inline-block bg-blue-600 text-white px-1.5 py-0.5 rounded text-[11px] mb-2">
                        {effect.category}
                      </div>
                      <div
                        className={`font-bold mb-1.5 text-sm ${isDisabled ? 'text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}
                      >
                        {effect.displayName}
                      </div>
                      <div
                        className={`text-xs mb-1.5 ${isDisabled ? 'text-gray-400 dark:text-gray-600' : 'text-gray-600 dark:text-gray-400'}`}
                      >
                        by {effect.author}
                      </div>
                      <div className="flex gap-2 mt-2.5">
                        <button
                          className={`flex-1 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors ${isDisabled ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed opacity-50' : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            !isDisabled && onSelectEffect && onSelectEffect(effect.name);
                          }}
                          disabled={isDisabled}
                        >
                          Use
                        </button>
                        <button
                          className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 text-xs cursor-pointer transition-colors hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isDisabled) {
                              onEnableEffect && onEnableEffect(effect.name);
                            } else {
                              onDisableEffect && onDisableEffect(effect.name);
                            }
                          }}
                        >
                          {isDisabled ? 'Enable' : 'Disable'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

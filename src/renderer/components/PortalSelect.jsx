/**
 * PortalSelect - Custom select component using portal for dropdown positioning
 *
 * DESIGN EXCEPTION: We normally prefer native HTML elements (see SYSTEM_ARCHITECTURE.md),
 * but native <select> dropdowns are broken on Linux due to Electron 38+ Wayland bugs.
 * The dropdown renders at the top-left corner instead of below the select element.
 * See: https://github.com/electron/electron/issues/44607
 *
 * This component renders the dropdown via a React portal to document.body,
 * bypassing the Wayland popup positioning bug. We maintain as much native
 * behavior as possible: keyboard navigation, focus management, escape to close.
 *
 * This workaround should be removed when Electron fixes Wayland popup positioning.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export function PortalSelect({
  id,
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, minWidth: 0, openUpward: false });
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  // Estimated dropdown height for positioning calculation
  const DROPDOWN_MAX_HEIGHT = 240; // matches max-h-60 (15rem = 240px)

  // Find the selected option's label
  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  // Find index of currently selected value
  const selectedIndex = options.findIndex((opt) => opt.value === value);

  // Update dropdown position when opened
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Determine if we should open upward
      const estimatedHeight = Math.min(options.length * 40, DROPDOWN_MAX_HEIGHT);
      const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

      setPosition({
        top: openUpward ? rect.top - 2 : rect.bottom + 2,
        left: rect.left,
        minWidth: rect.width,
        openUpward,
      });
    }
  }, [options.length]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [isOpen, updatePosition, selectedIndex]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on scroll outside dropdown to prevent misalignment
  useEffect(() => {
    if (!isOpen) return;

    const handleScroll = (event) => {
      // Don't close if scrolling within the dropdown itself
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  const handleSelect = useCallback(
    (optionValue) => {
      onChange?.({ target: { value: optionValue } });
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  // Keyboard navigation matching native select behavior
  const handleKeyDown = useCallback(
    (event) => {
      switch (event.key) {
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (isOpen && focusedIndex >= 0) {
            handleSelect(options[focusedIndex].value);
          } else {
            setIsOpen(!isOpen);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setIsOpen(false);
          triggerRef.current?.focus();
          break;
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            setFocusedIndex((prev) => Math.min(prev + 1, options.length - 1));
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (isOpen) {
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'Home':
          event.preventDefault();
          if (isOpen) setFocusedIndex(0);
          break;
        case 'End':
          event.preventDefault();
          if (isOpen) setFocusedIndex(options.length - 1);
          break;
        case 'Tab':
          if (isOpen) setIsOpen(false);
          break;
        default:
          // Type-to-search: find first option starting with pressed key
          if (event.key.length === 1 && isOpen) {
            const char = event.key.toLowerCase();
            const idx = options.findIndex((opt) => opt.label.toLowerCase().startsWith(char));
            if (idx >= 0) setFocusedIndex(idx);
          }
      }
    },
    [isOpen, focusedIndex, options, handleSelect]
  );

  // Scroll focused option into view
  useEffect(() => {
    if (isOpen && dropdownRef.current && focusedIndex >= 0) {
      const focusedElement = dropdownRef.current.children[focusedIndex];
      focusedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, focusedIndex]);

  return (
    <>
      {/* Trigger Button - styled to match native select */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between text-left ${className}`}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={id}
      >
        <span className="truncate">{displayText}</span>
        <svg
          className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Portal - renders at document.body to bypass Wayland positioning bug */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg max-h-60 overflow-y-auto"
            style={{
              ...(position.openUpward
                ? { bottom: window.innerHeight - position.top, left: position.left }
                : { top: position.top, left: position.left }),
              minWidth: position.minWidth,
            }}
            role="listbox"
            onKeyDown={handleKeyDown}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                className={`px-3 py-2 cursor-pointer transition-colors whitespace-nowrap ${
                  index === focusedIndex
                    ? 'bg-blue-500 text-white'
                    : option.value === value
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                      : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
                onClick={() => handleSelect(option.value)}
                role="option"
                aria-selected={option.value === value}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

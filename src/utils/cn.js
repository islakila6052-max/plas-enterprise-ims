// src/utils/cn.js
/**
 * Tiny classNames helper. Joins truthy class fragments.
 * @param {...(string|false|null|undefined)} classes
 * @returns {string}
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

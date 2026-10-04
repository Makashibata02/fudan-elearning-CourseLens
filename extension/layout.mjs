export function fitScale(width, height, availableWidth, availableHeight, mode = 'page', custom = 1) {
  if (mode === 'custom') return Math.min(4, Math.max(.02, custom));
  if (!(width > 0 && height > 0)) return 1;
  const x = Math.max(1, availableWidth) / width;
  const y = Math.max(1, availableHeight) / height;
  return Math.min(2, mode === 'width' ? x : Math.min(x, y));
}
export function viewportSize(root) {
  const css = getComputedStyle(root);
  return {
    width: root.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) - 2,
    height: root.clientHeight - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0) - 30,
  };
}
export function scrollToPage(root, page) {
  root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top - (parseFloat(getComputedStyle(root).paddingTop) || 0);
}
export function visiblePage(root, pages) {
  const top = root.getBoundingClientRect().top + root.clientHeight * .25;
  const index = pages.findIndex((page) => !page.hidden && page.getBoundingClientRect().bottom > top);
  return index < 0 ? pages.length : index + 1;
}

/** Creates an element with optional text and class name, which most page code sets right away. */
export const element = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[Tag] => {
  const node = document.createElement(tag);

  if (text !== undefined) {
    node.textContent = text;
  }
  if (className) {
    node.className = className;
  }
  return node;
};

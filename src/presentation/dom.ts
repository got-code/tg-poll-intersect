export function elements<Elements extends Record<keyof Elements, HTMLElement>>() {
  return function $<Id extends keyof Elements & string>(id: Id): Elements[Id] {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing application element: ${id}`);
    // Each presentation module owns its ID/type map alongside the HTML template.
    return node as Elements[Id];
  };
}

export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = '',
  text?: string | number,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

export function createStatus(node: HTMLElement) {
  return (text: string, error = false) => {
    node.textContent = text;
    node.classList.toggle('error', error);
  };
}

export const $ = id => document.getElementById(id);

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function status(text, error = false, id = 'status') {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}

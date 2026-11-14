import { element } from '../../../presentation/dom.ts';

export function createTooltip() {
  let tooltip: HTMLDivElement | undefined;
  let activeTarget: HTMLElement | null = null;
  let focusedTarget: HTMLButtonElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function hide() {
    clearTimeout(hideTimer);
    if (tooltip) tooltip.hidden = true;
    activeTarget?.removeAttribute('aria-describedby');
    activeTarget = null;
  }
  function leave() {
    if (document.activeElement !== activeTarget) hideTimer = setTimeout(hide, 200);
  }
  function show(button: HTMLElement, text: string) {
    if (!tooltip) {
      tooltip = element('div', 'person-tooltip');
      tooltip.id = 'personTooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      tooltip.addEventListener('mouseleave', leave);
      document.body.append(tooltip);
      document.addEventListener('pointerdown', (event) => {
        if (event.target !== activeTarget && event.target !== tooltip) hide();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hide();
      });
      document.addEventListener(
        'scroll',
        (event) => {
          if (event.target !== tooltip) hide();
        },
        true,
      );
      window.addEventListener('resize', hide);
    }
    hide();
    activeTarget = button;
    tooltip.textContent = text;
    tooltip.hidden = false;
    button.setAttribute('aria-describedby', tooltip.id);
    const rect = button.getBoundingClientRect();
    const width = tooltip.offsetWidth,
      height = tooltip.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    tooltip.style.left = Math.min(Math.max(8, rect.left), maxLeft) + 'px';
    const top = rect.top >= height + 12 ? rect.top - height - 6 : rect.bottom + 6;
    tooltip.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + 'px';
  }
  function bind(button: HTMLButtonElement, text: string) {
    let hovered = false;
    button.addEventListener('mouseenter', () => {
      hovered = true;
      requestAnimationFrame(() => {
        if (hovered && button.isConnected && !focusedTarget?.isConnected) show(button, text);
      });
    });
    button.addEventListener('mousemove', () => {
      if (activeTarget === button) return;
      requestAnimationFrame(() => {
        if (hovered && button.isConnected) show(button, text);
      });
    });
    button.addEventListener('mouseleave', () => {
      hovered = false;
      leave();
    });
    // Focus can scroll other names under the pointer. Keep the focused name's
    // explanation and show it after the scroll has settled.
    button.addEventListener('focus', () => {
      focusedTarget = button;
      requestAnimationFrame(() => {
        if (document.activeElement === button) show(button, text);
      });
    });
    button.addEventListener('blur', () => {
      if (focusedTarget === button) focusedTarget = null;
      hide();
    });
    button.addEventListener('click', () => show(button, text));
  }
  return { bind, hide };
}

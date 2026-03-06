"use client";

import { useEffect } from "react";

const DEVTOOLS_SELECTORS = [
  "#next-logo",
  "[data-next-mark]",
  "[data-nextjs-dev-tools-button]",
  "[aria-controls='nextjs-dev-tools-menu']",
  "[aria-label='Open Next.js Dev Tools']",
].join(",");

function hideDevToolsButtons(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>(DEVTOOLS_SELECTORS)) {
    element.style.setProperty("display", "none", "important");
    element.setAttribute("hidden", "true");
    element.setAttribute("aria-hidden", "true");
  }
}

export default function HideNextDevTools() {
  useEffect(() => {
    hideDevToolsButtons(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.matches(DEVTOOLS_SELECTORS)) {
            hideDevToolsButtons(document);
            continue;
          }

          hideDevToolsButtons(node);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}

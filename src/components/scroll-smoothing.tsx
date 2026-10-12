"use client";

import { useEffect } from "react";

/**
 * Marks the page as scrolling (html.is-scrolling) and clears it 150 ms after the last scroll
 * event. globals.css uses it to pause card hover effects mid-scroll, a common source of jank.
 * Passive listener; one class toggle per scroll burst, not per event.
 */
export function ScrollSmoothing() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!timer) root.classList.add("is-scrolling");
      else clearTimeout(timer);
      timer = setTimeout(() => {
        root.classList.remove("is-scrolling");
        timer = undefined;
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
      root.classList.remove("is-scrolling");
    };
  }, []);
  return null;
}

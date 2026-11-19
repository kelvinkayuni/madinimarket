"use client";

import { useCallback, useEffect, useRef } from "react";

export default function HomepageScrollIndicator() {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const scrollRange = pageHeight - viewportHeight;
    const trackHeight = track.clientHeight;
    const canScroll = scrollRange > 1 && trackHeight > 0;
    track.dataset.visible = String(canScroll);
    if (!canScroll) return;

    const thumbHeight = Math.min(trackHeight, Math.max(36, trackHeight * viewportHeight / pageHeight));
    const thumbTravel = trackHeight - thumbHeight;
    const scrollTop = Math.min(scrollRange, Math.max(0, window.scrollY));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${scrollTop / scrollRange * thumbTravel}px)`;
  }, []);

  useEffect(() => {
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(document.documentElement);
    observer?.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    document.addEventListener("load", update, true);
    update();

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("load", update, true);
    };
  }, [update]);

  return <div className="homepage-scroll-indicator" ref={trackRef} data-visible="false" aria-hidden="true">
    <div className="homepage-scroll-indicator-thumb" ref={thumbRef} />
  </div>;
}

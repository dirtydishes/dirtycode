(() => {
  const progress = document.querySelector(".reading-progress span");
  const navLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const openHashTarget = () => {
    if (!window.location.hash) return;
    const target = document.querySelector(window.location.hash);
    const details = target?.closest("details");
    if (details) details.open = true;
  };

  const setCurrent = (id) => {
    for (const link of navLinks) {
      if (link.getAttribute("href") === `#${id}`) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  };

  const updateProgress = () => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = range <= 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / range));
    if (progress) progress.style.transform = `scaleX(${ratio})`;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setCurrent(visible[0].target.id);
    },
    { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
  );

  for (const section of sections) observer.observe(section);
  for (const link of navLinks) {
    link.addEventListener("click", () => {
      const target = document.querySelector(link.getAttribute("href"));
      const details = target?.closest("details");
      if (details) details.open = true;
    });
  }

  document.querySelector(".skip-link")?.addEventListener("click", () => {
    window.requestAnimationFrame(() => document.querySelector("main")?.focus());
  });

  window.addEventListener("hashchange", openHashTarget);
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress, { passive: true });
  openHashTarget();
  updateProgress();
})();

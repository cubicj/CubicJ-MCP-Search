const NAMU_WIKI_HOST = "namu.wiki";

export function parseNamuWikiUrl(url: URL): { title: string } | null {
  if (url.hostname !== NAMU_WIKI_HOST) return null;

  const match = url.pathname.match(/^\/w\/(.+)$/);
  if (!match) return null;

  try {
    const title = decodeURIComponent(match[1]);
    return title ? { title } : null;
  } catch {
    return null;
  }
}

export function findContentContainer(document: Document): Element | null {
  const headings = Array.from(document.body?.querySelectorAll("h2,h3,h4,h5,h6") ?? []);
  if (headings.length < 2) return null;

  let commonAncestors: Element[] = [];
  for (let element = headings[0].parentElement; element; element = element.parentElement) {
    commonAncestors.push(element);
  }

  for (const heading of headings.slice(1)) {
    const candidates = new Set(commonAncestors);
    let ancestor = heading.parentElement;
    while (ancestor && !candidates.has(ancestor)) ancestor = ancestor.parentElement;
    if (!ancestor) return null;
    commonAncestors = commonAncestors.slice(commonAncestors.indexOf(ancestor));
  }

  return commonAncestors[0] ?? null;
}

// Hash routing: the server serves one page, and every view lives under #/.
import { useEffect, useState } from "react";

export function parseHash() {
  const [path = "/", search = ""] = (location.hash.slice(1) || "/").split("?");
  return { path, query: new URLSearchParams(search) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (hash: string) => { location.hash = hash; };
export const enc = encodeURIComponent;

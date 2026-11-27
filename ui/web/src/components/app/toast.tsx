// A minimal toast: one line at the bottom of the screen for a second or two.
import { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
export const toast = (text: string) => listeners.forEach((l) => l(text));

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const on: Listener = (text) => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list, { id, text }]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 1800);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2">
      {items.map((x) => (
        <div key={x.id} className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 flex items-center gap-2 rounded-md border px-4 py-2 text-sm shadow-lg">
          <CheckIcon className="text-success size-4" />{x.text}
        </div>
      ))}
    </div>
  );
}

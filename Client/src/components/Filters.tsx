import { FILTERS } from "../lib/filters";
import { useApp } from "../state";
import { Sheet } from "./Sheets";

/** Horizontal chip row of camera filters. Applies instantly, also mid-call. */
export function FilterBar() {
  const filter = useApp((s) => s.prefs.filter);
  const setPref = useApp((s) => s.setPref);
  return (
    <div className="filter-bar" role="radiogroup" aria-label="Camera filter">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          role="radio"
          aria-checked={filter === f.id}
          className="filter-chip"
          onClick={() => setPref("filter", f.id)}
        >
          <i style={{ background: f.swatch }} aria-hidden="true" />
          <span>{f.name}</span>
        </button>
      ))}
    </div>
  );
}

export function FiltersSheet() {
  return (
    <Sheet label="Camera filters" onClose={() => useApp.getState().openSheet(null)}>
      <h2 className="display">Filters</h2>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
        Everyone in the room sees your filter. Runs on your device — nothing is uploaded.
      </p>
      <FilterBar />
    </Sheet>
  );
}

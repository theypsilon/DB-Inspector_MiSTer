// How long a find-in-page jump keeps its row highlighted.
export const SEARCH_FLASH_MS = 3000;

// The flash of the row a find-in-page jump landed on. It ends after SEARCH_FLASH_MS, or earlier
// when the search closes or moves on; `onChange(rowId, flashing)` follows it. Timers come from
// `setTimeout`/`clearTimeout`, so the flash outlives the effect that starts it.
export function createRowFlash({ setTimeout, clearTimeout, onChange }) {
  let rowId = null;
  let timer = 0;

  function end() {
    clearTimeout(timer);
    if (rowId === null) {
      return;
    }

    const endedRowId = rowId;
    rowId = null;
    onChange(endedRowId, false);
  }

  function start(nextRowId) {
    end();
    rowId = nextRowId;
    onChange(nextRowId, true);
    timer = setTimeout(end, SEARCH_FLASH_MS);
  }

  // Stops the timer without ending the flash, when the rows go away.
  function dispose() {
    clearTimeout(timer);
  }

  return { start, end, dispose };
}

// ===========================================================================
//  Renders one month as a Sun–Sat grid, with arrows to move between months
// ===========================================================================

// Variables for elements the calendar will use
const titleEl = document.getElementById("calendar-title");
const gridEl  = document.getElementById("calendar-grid");
const prevBtn = document.getElementById("prev-month");
const nextBtn = document.getElementById("next-month");

// Modal elements
const modalEl        = document.getElementById("show-modal");
const modalContentEl = document.getElementById("modal-content");
const modalCloseEl   = document.getElementById("modal-close");

// Month names for the title
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// ===============================================
// State: which month are we currently showing?
// ===============================================

// Start on today's real month.
// getFullYear/getMonth read the current date.
const today   = new Date();
let viewYear  = today.getFullYear();
let viewMonth = today.getMonth();   // 0–11

// date-keyed lookup, e.g. { "2026-07-18": {…show…} }.
// Starts empty; fetch() fills it in before the first render.
let showsByDate = {};

let fillerList = [];   // array from filler.json

// ==================
//     Date Key
// ==================

// Build the "YYYY-MM-DD" key for a given day, matching shows.json.
// padStart(2, "0") turns 7 into "07" so keys line up exactly.
function dateKey(year, month, day) {
    const mm = String(month + 1).padStart(2, "0");   // month is 0-indexed → +1
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
}

// ==================
//    Date Format
// ==================

// Turn "2026-07-18" into "Saturday, July 18, 2026".
// We split the string and build a LOCAL date. Passing the raw string to
// new Date() would parse it as UTC midnight and can show the previous day.
function formatLongDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);   // ["2026","07","18"] → [2026, 7, 18]
    const d = new Date(year, month - 1, day);                    // month back to 0-indexed
    return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
}



// For random filler images in calendar (fixed per month)
// Give it a seed number.
// It returns a function that returns a repeatable
// stream of numbers between 0 and 1 — SAME stream every time for that seed.
function makeRandom(seed) {
    let state = seed >>> 0;               // force a 32-bit unsigned integer
    return function () {
        state |= 0; state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ===================
//     Load Shows
// ===================

// fetch shows once, index by date, draw the calendar
async function loadShows() {
    try {
        const response = await fetch("shows.json");

        // Check request succeeded before parsing
        if (!response.ok) {
            throw new Error(`shows.json returned ${response.status}`);
        }

        const shows = await response.json();

        // Turn array into lookup object
        showsByDate = {};
        for (const show of shows) {
        showsByDate[show.date] = show;
        }
    }
    catch (error) {
    // If file is missing or fetch fails, we still show an empty
    // calendar. Log it.
        console.error("Could not load shows.json:", error);
    }

    // Load filler images
    try {
        const response = await fetch("filler.json");
        if (!response.ok) throw new Error(`filler.json returned ${response.status}`);
        fillerList = await response.json();
    }
    catch (error) {
        console.error("Could not load filler.json:", error);
        // fillerList stays [] — calendar just renders without filler.
    }

    renderCalendar();   // render only after the data is ready
}

// ===============================================
// Render: draw the month the state points to
// ===============================================

function renderCalendar() {

    // Title
    titleEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    // How many blanks before day 1?
    // Build the 1st, ask its weekday
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();

    // How many days this month?
    // Day 0 of next month rolls back to last day of THIS month.
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Days in PREVIOUS month (for leading spillover numbers).
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    // Round up to whole weeks.
    // This makes the grid 5 rows for most
    // months and 6 when a month overflows.
    const usedCells  = firstWeekday + daysInMonth;
    const totalCells = Math.ceil(usedCells / 7) * 7;   // 28, 35, or 42

    // Clear last month's cells.
    gridEl.innerHTML = "";

    // Filler planning (fixed per month)
    // Seed from year + month, every visit to this month identical.
    const seed = viewYear * 100 + (viewMonth + 1);
    const rng  = makeRandom(seed);

    const FILLER_CHANCE = 0.35;   // ~35% of eligible empty days get filler

    // Leading spillover: previous month's last `firstWeekday` days
    const firstSpill = daysInPrevMonth - firstWeekday + 1;
    for (let d = firstSpill; d <= daysInPrevMonth; d++) {
        gridEl.appendChild(makeCell(d, { inactive: true }));
    }

    // Current month
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday =
            viewYear  === today.getFullYear() &&
            viewMonth === today.getMonth() &&
            day       === today.getDate();

        const show = showsByDate[dateKey(viewYear, viewMonth, day)];

        // Decide filler ONLY for empty days (no show).
        // Always pull from rng in the same order so sequence stays deterministic.
        let filler = null;
        if (!show && fillerList.length > 0) {
            const roll = rng();                       // first draw: do we fill?
            const pick = Math.floor(rng() * fillerList.length);  // second draw: which one?
            if (roll < FILLER_CHANCE) {
                filler = fillerList[pick];
            }
        }

        gridEl.appendChild(makeCell(day, { inactive: false, today: isToday, show, filler }));
    }

    // ---- Trailing spillover: next month's first days, up to the row boundary ----
    const trailing = totalCells - usedCells;
    for (let d = 1; d <= trailing; d++) {
        gridEl.appendChild(makeCell(d, { inactive: true }));
    }
}

// ====================================================
//  Make Cell
//  Helper: build one <div class="day-cell">
// ====================================================

// createElement avoids re-parsing the whole grid each pass.
function makeCell(dayNumber, opts) {
    const { inactive = false, today: isToday = false, show = null, filler = null } = opts || {};

    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (inactive) cell.classList.add("inactive");
    if (isToday)  cell.classList.add("today");

    const numberEl = document.createElement("span");
    numberEl.className = "day-number";
    numberEl.textContent = dayNumber;
    cell.appendChild(numberEl);

    // If this day has a show, mark the cell and render info.
    if (show) {
        cell.classList.add("has-show");
        cell.classList.add("clickable");                  // CSS gives it a pointer cursor
        cell.addEventListener("click", () => openShowModal(show));

        const info = document.createElement("div");
        info.className = "show-info";

        // Headliner is the first name in the lineup; city sits beneath it.
        const headliner = document.createElement("div");
        headliner.className = "show-headliner";
        headliner.textContent = show.venue;

        const city = document.createElement("div");
        city.className = "show-city";
        city.textContent = show.city;

        info.appendChild(headliner);
        info.appendChild(city);
        cell.appendChild(info);
    }

    // If empty day was assigned filler, drop in image.
    if (filler) {
        cell.classList.add("has-filler");

        if (filler.img) {
            const img = document.createElement("img");
            img.className = "filler-img";
            img.src = filler.img;
            img.alt = "";            // decorative — empty alt so screen readers skip it
            img.loading = "lazy";    // don't fetch until near the viewport
            cell.appendChild(img);
        }

        if (filler.caption) {        // skipped entirely when caption is ""
            const cap = document.createElement("div");
            cap.className = "filler-caption";
            cap.textContent = filler.caption;
            cell.appendChild(cap);
        }
    }

    return cell;
}

// =====================
//     Open Modal
// =====================

// Build the detail view for one show and reveal the modal.
function openShowModal(show) {
    // Full lineup as a comma list, e.g. "Johnny!, Wharf Rats, Sea Lion Attack".
    const lineup = show.lineup.join(", ");

    // Build the inner HTML. Fields that might be empty are added conditionally
    // so we never show a blank "Notes:" line.
    let html = `
        <h2 class="modal-date">${formatLongDate(show.date)}</h2>
        <p class="modal-venue">${show.venue}</p>
        <p class="modal-city">${show.city}</p>
        <p class="modal-line"><span>Time:</span> ${show.time}</p>
        <p class="modal-line"><span>Price:</span> ${show.price}</p>
        <p class="modal-line"><span>Ages:</span> ${show.ageLimit}</p>
        <p class="modal-line"><span>Lineup:</span> ${lineup}</p>
    `;

    if (show.notes) {
        html += `<p class="modal-line"><span>Notes:</span> ${show.notes}</p>`;
    }

    modalContentEl.innerHTML = html;
    modalEl.classList.remove("hidden");   // reveal (your CSS hides it with .hidden)
}

// Hide the modal.
function closeShowModal() {
    modalEl.classList.add("hidden");
}

// ===============================================
// Arrows change month, then re-render
// ===============================================

// prev arrow logic
prevBtn.addEventListener("click", () => {
    viewMonth--;
    if (viewMonth < 0) {   // stepped back past January
        viewMonth = 11;      // December
        viewYear--;          // of the previous year
    }
    renderCalendar();
});

// next arrow logic
nextBtn.addEventListener("click", () => {
    viewMonth++;
    if (viewMonth > 11) {  // stepped forward past December
        viewMonth = 0;       // January
        viewYear++;          // of the next year
    }
    renderCalendar();
});

// Close on the ✕ button
modalCloseEl.addEventListener("click", closeShowModal);

// Close when clicking the dark backdrop (but NOT when clicking inside the box)
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) closeShowModal();
});

// Close on the Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeShowModal();
});

// draw the current month 
loadShows();
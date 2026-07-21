// ===========================================================================
//  Renders one month as a Sun–Sat grid, with arrows to move between months
// ===========================================================================

// Variables for elements the calendar will use
const titleEl = document.getElementById("calendar-title");
const gridEl  = document.getElementById("calendar-grid");
const prevBtn = document.getElementById("prev-month");
const nextBtn = document.getElementById("next-month");

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
const today = new Date();
let viewYear  = today.getFullYear();
let viewMonth = today.getMonth();   // 0–11

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

  // Clear last month's cells.
  gridEl.innerHTML = "";

  // Leading blanks: one padding cell per weekday before day 1.
  for (let i = 0; i < firstWeekday; i++) {
    gridEl.appendChild(makeCell("", true));
  }

  // The real days: 1 ... daysInMonth.
  for (let day = 1; day <= daysInMonth; day++) {
    gridEl.appendChild(makeCell(day, false));
  }
}

// ===============================================
// Helper: build one <div class="day-cell">
// ===============================================

// createElement avoids re-parsing the whole grid each pass.
function makeCell(dayNumber, isPad) {
  const cell = document.createElement("div");
  cell.className = "day-cell";

  if (isPad) {
    cell.classList.add("empty-pad");   // darker face; reads as "not this month"
    return cell;                        // no number, no content
  }

  const numberEl = document.createElement("span");
  numberEl.className = "day-number";
  numberEl.textContent = dayNumber;
  cell.appendChild(numberEl);
  return cell;
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

// draw the current month 
renderCalendar();
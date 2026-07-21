// Grab the two elements we need to talk to.
// - the hamburger button (what the user taps)
// - the link list (what we show/hide)
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector("#primary-nav");

// Listen for taps/clicks on the hamburger.
navToggle.addEventListener("click", () => {
    // toggle() adds ".open" if it's missing, removes it if it's there.
    // This is the class your CSS uses to switch display:none -> display:flex.
    const isOpen = navLinks.classList.toggle("open");

    // Keep the accessibility attribute in sync with what's on screen,
    // so screen readers announce "expanded" / "collapsed" correctly.
    navToggle.setAttribute("aria-expanded", isOpen);
});

// Nice-to-have: if a link is tapped, close the menu so the next
// page (or same-page scroll) doesn't leave the menu hanging open.
navLinks.addEventListener("click", (event) => {
    // Only react when an actual <a> was tapped, not empty space in the list.
    if (event.target.matches("a")) {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
    }
});
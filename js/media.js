// Find every facade button on the page.
// querySelectorAll takes a CSS selector and returns ALL matches as a NodeList.
// (querySelector, singular, returns only the first match.)
const facades = document.querySelectorAll('.video-facade');

facades.forEach(facade => {
    facade.addEventListener('click', () => {

        // 1. Create a new <iframe> element. It exists only in memory right
        //    now — nothing appears on the page until we insert it below.
        const iframe = document.createElement('iframe');

        // 2. Build the embed URL.
        //    Backticks make a TEMPLATE LITERAL: a string where ${...} is
        //    replaced by the value of the expression inside.
        //    autoplay=1 starts playback immediately — appropriate here because
        //    the user just clicked to play. Browsers block autoplay with sound
        //    on page load, but permit it after a user gesture like this one.
        iframe.src = `https://www.youtube.com/embed/${facade.dataset.videoId}?autoplay=1`;

        // 3. An iframe needs a title. Screen readers announce it when the user
        //    reaches the frame; without one they hear only "frame".
        //    Reuse the button's aria-label so the wording stays identical.
        iframe.title = facade.getAttribute('aria-label');

        // 4. Permissions the embedded player needs. Without "autoplay" in this
        //    list, the autoplay=1 parameter is ignored.
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
        iframe.allowFullscreen = true;

        // 5. Class hook so CSS can size it the same as the thumbnail.
        iframe.className = 'video-frame';

        // 6. THE SWAP. replaceWith removes the button from the DOM and puts
        //    the iframe in its exact position. The button — and its listener —
        //    are discarded.
        facade.replaceWith(iframe);
    });
});
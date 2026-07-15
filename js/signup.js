const form = document.getElementById('signup-form');
const messageE1 = document.getElementById('signup-message');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;

    // Grab a reference to the submit button so we can disable it.
    // querySelector searches *within* the form for a button with type="submit".
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;   // blocks further clicks immediately

    try {
        const response = await fetch('https://johnny-site.onrender.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });

        const data = await response.json();

        if (response.ok) {
            messageE1.textContent = data.message;
            form.reset();
            // Note: button stays disabled here — the signup succeeded, so
            // there's nothing more to submit. It resets naturally next time
            // the user reloads the page.
        } else {
            messageE1.textContent = data.error;
            submitButton.disabled = false;  // let them retry - something went wrong
        }
    } catch (error) {
        messageE1.textContent = 'Something went wrong. Please try again.';
        submitButton.disabled = false;  // network failure - also worth retry
    }
});
/** How long a page notice stays up, in milliseconds */
const NOTICE_MILLISECONDS = 6000;

/** Shows a message in the page's `#notice` element for a few seconds. */
export const showNotice = (message: string): void => {
  const notice = document.getElementById('notice')!;

  notice.textContent = message;
  notice.hidden = false;
  setTimeout(() => {
    notice.hidden = true;
  }, NOTICE_MILLISECONDS);
};

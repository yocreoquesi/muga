// MUGA — Redirect unwrapping
// Detects known redirect/tracking wrappers and navigates directly to the destination

(function() {
  const url = new URL(window.location.href);
  const host = url.hostname;
  let destination = null;

  // Facebook: l.facebook.com/l.php?u=ENCODED_URL
  if (host === 'l.facebook.com') {
    destination = url.searchParams.get('u');
  }
  // Reddit: out.reddit.com?url=ENCODED_URL
  else if (host === 'out.reddit.com') {
    destination = url.searchParams.get('url');
  }
  // Google / Gmail: google.com/url?q=ENCODED_URL
  else if (host === 'www.google.com' && url.pathname === '/url') {
    destination = url.searchParams.get('q') || url.searchParams.get('url');
  }
  // Steam: store.steampowered.com/linkfilter/?url=ENCODED_URL
  else if (host === 'store.steampowered.com' && url.pathname.startsWith('/linkfilter/')) {
    destination = url.searchParams.get('url');
  }
  // Instagram: instagram.com/l/ENCODED_URL (base64 path)
  else if (host === 'www.instagram.com' && url.pathname.startsWith('/l/')) {
    try {
      destination = atob(url.pathname.replace('/l/', ''));
    } catch(e) {}
  }

  if (destination) {
    try {
      // Validate it's actually a URL before redirecting
      const dest = new URL(destination);
      if (dest.protocol === 'https:' || dest.protocol === 'http:') {
        window.location.replace(destination);
      }
    } catch(e) {
      // Not a valid URL, don't redirect
    }
  }
})();

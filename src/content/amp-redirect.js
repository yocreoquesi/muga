// MUGA — AMP de-amplification
// Redirect Google AMP URLs to canonical non-AMP URLs

(function() {
  const href = window.location.href;

  // Pattern: https://www.google.com/amp/s/publisher.com/path
  const googleAmp = href.match(/^https:\/\/www\.google\.com\/amp\/s\/(.+)/);
  if (googleAmp) {
    const canonical = 'https://' + googleAmp[1];
    window.location.replace(canonical);
    return;
  }

  // Pattern: https://amp.publisher.com/path → https://publisher.com/path
  const ampSubdomain = href.match(/^(https?:\/\/)amp\.(.+)/);
  if (ampSubdomain) {
    window.location.replace(ampSubdomain[1] + ampSubdomain[2]);
    return;
  }

  // Check for canonical link in the page head (more reliable for edge cases)
  // Run after DOM is available
  document.addEventListener('DOMContentLoaded', () => {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href && canonical.href !== href) {
      const canonicalUrl = canonical.href;
      // Only redirect if it's clearly a non-AMP version
      if (!canonicalUrl.includes('/amp/') && !canonicalUrl.includes('amp.')) {
        window.location.replace(canonicalUrl);
      }
    }
  });
})();

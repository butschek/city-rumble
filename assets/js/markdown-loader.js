/**
 * Information-page Markdown renderer.
 *
 * Expected HTML contract:
 * - #markdown: a <script type="text/markdown"> containing editable Markdown.
 * - #content: the element that receives the rendered HTML.
 * - This classic script is included after those two elements.
 *
 * Each information page owns its stylesheet; this loader only renders content.
 * markdown-it.min.js is loaded locally beside this file, so neither npm nor a
 * CDN is required at runtime, including when the page is opened via file://.
 */

(() => {
  'use strict';

  // Resolve relative to this loader, not the information page URL. Capture
  // document.currentScript synchronously while this classic script executes.
  const script = document.createElement('script');
  script.src = new URL('markdown-it.min.js', document.currentScript.src).href;

  script.onload = () => {
    // Raw HTML is disabled: author content stays Markdown rather than an
    // additional HTML injection surface. Link detection and typographic
    // replacements are enabled consistently for all information pages.
    const md = window.markdownit({
      html: false,
      linkify: true,
      typographer: true,
    });

    // Preserve markdown-it's normal link renderer and only add attributes.
    // renderToken is the default fallback when no custom rule exists.
    const defaultRender =
      md.renderer.rules.link_open ||
      function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      const href = tokens[idx].attrGet('href') || '';

      // Open web links outside the embedded information frame. Prevent
      // the destination from accessing the opener and omit referrer data.
      // Relative links and mailto: links keep their existing behavior.
      if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
      }

      return defaultRender(tokens, idx, options, env, self);
    };

    // The dependency has loaded; now render the source block once. Pages
    // lacking either element are intentionally left unchanged. This is not
    // a live editor: subsequent Markdown changes need a reload/re-render.
    const source = document.getElementById('markdown');
    const target = document.getElementById('content');

    if (source && target) {
      target.innerHTML = md.render(source.textContent);
      // The MIT notice is quoted in its original English.
      if (target.hasAttribute('data-mit-license')) {
        const notice = target.querySelector('blockquote');
        if (notice) {
          notice.lang = 'en';
          notice.dir = 'ltr';
        }
      }
    }
  };

  // Keep the existing console-only failure behavior. No visual error panel,
  // retry, timeout, or plain-text fallback is introduced by this loader.
  script.onerror = () => {
    console.error('markdown-it.min.js konnte nicht geladen werden.');
  };

  document.head.appendChild(script);
})();

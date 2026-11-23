// Narrow declarations for the sanitizer options used by this module.
declare module 'sanitize-html' {
  export default function sanitize(
    html: string,
    options: {
      allowedTags: string[];
      allowedAttributes: Record<string, string[]>;
      allowedSchemes: string[];
      allowProtocolRelative: boolean;
      disallowedTagsMode: 'discard';
      transformTags: Record<
        string,
        (
          tag: string,
          attrs: Record<string, string>,
        ) => { tagName: string; attribs: Record<string, string> }
      >;
    },
  ): string;
}

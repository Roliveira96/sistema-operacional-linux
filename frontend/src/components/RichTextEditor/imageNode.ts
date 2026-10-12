import { mergeAttributes, Node } from "@tiptap/react";

/**
 * An image of the text (SPEC-035 D-12): only its address and its alternative text, the attributes the server keeps when it filters
 * the html. Written here, on the core of the editor, instead of adding a new dependency.
 */
export const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },
});

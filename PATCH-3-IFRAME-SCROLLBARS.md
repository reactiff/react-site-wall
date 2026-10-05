Please make the iFrame's scrollbar track transparent

I think you need to inject it like this

const style = doc.createElement("style");
style.textContent = `
  ::-webkit-scrollbar-track {
    background: transparent;
  }
`;
doc.head.appendChild(style);


But you need to give it more specificity so it only appliest to the iframe's document, not anything else within it.
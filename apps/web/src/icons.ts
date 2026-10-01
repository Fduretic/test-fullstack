import { Component, input } from '@angular/core';

@Component({
  selector: 'app-icon', standalone: true,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path [attr.d]="paths[name()] || paths['image']"/></svg>`,
  styles: [`:host{display:inline-flex;width:1.25em;height:1.25em;flex-shrink:0;vertical-align:middle}svg{width:100%;height:100%}`],
})
export class Icon {
  name = input('image');
  paths: Record<string, string> = {
    image: 'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M16 8h.01',
    album: 'M4 3h15v18H4z M8 3v18 M11 8h5 M11 12h5 M2 7h4 M2 12h4 M2 17h4',
    plus: 'M12 5v14 M5 12h14', arrow: 'M4 12h16 M14 6l6 6-6 6',
    back: 'M20 12H4 M10 6l-6 6 6 6', grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    upload: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
    edit: 'M14 5l5 5 M4 20l1-6L16 3l5 5L10 19z',
    trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    close: 'M5 5l14 14 M19 5L5 19', check: 'M4 12l5 5L20 6',
    sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
  };
}

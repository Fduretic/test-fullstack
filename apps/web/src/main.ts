import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterLink, RouterOutlet, withInMemoryScrolling } from '@angular/router';
import { Icon } from './icons';
import { HomePage, AlbumPage, leaveAlbum } from './pages';

@Component({
  selector: 'app-root', standalone: true, imports: [RouterLink, RouterOutlet, Icon],
  template: `
    <header class="site-header"><div class="header-inner">
      <a class="brand" routerLink="/" aria-label="Fullstack with storage home">
        <span class="brand-icon"><app-icon name="album"/></span>
        <span>fullstack<span class="brand-sub">with storage</span></span>
      </a>
      <nav aria-label="Main navigation"><a class="nav-link" routerLink="/"><app-icon name="grid"/> My albums</a>
        <a class="button small primary" routerLink="/albums/new"><app-icon name="plus"/> New album</a></nav>
    </div></header>
    <main id="main-content"><router-outlet/></main>
    <footer class="site-footer"><span><span class="status-dot"></span> A little space for the good stuff.</span><span>MADE FOR YOUR MEMORIES <app-icon name="sun"/></span></footer>
  `,
})
class App {}

bootstrapApplication(App, {
  providers: [provideRouter([
    { path: '', component: HomePage, title: 'My albums · Fullstack with storage' },
    { path: 'albums/new', component: AlbumPage, canDeactivate: [leaveAlbum], title: 'New album · Fullstack with storage' },
    { path: 'albums/:id/edit', component: AlbumPage, canDeactivate: [leaveAlbum], data: { edit: true }, title: 'Edit album · Fullstack with storage' },
    { path: 'albums/:id', component: AlbumPage, canDeactivate: [leaveAlbum], title: 'Album · Fullstack with storage' },
    { path: '**', redirectTo: '' },
  ], withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }))],
}).catch(() => { document.body.textContent = 'The album app could not start. Please reload the page.'; });

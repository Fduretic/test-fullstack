import { Component, computed, inject, signal, HostListener, OnDestroy, OnInit, ElementRef, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, Album, Photo, assetUrl } from './api';
import { Icon } from './icons';

@Component({
  standalone: true, imports: [RouterLink, DatePipe, Icon], templateUrl: './home.html',
})
export class HomePage implements OnInit {
  private api = inject(Api);
  albums = signal<Album[]>([]); loading = signal(true); error = signal('');
  totalPhotos = computed(() => this.albums().reduce((sum, album) => sum + album.photoCount, 0));
  asset = assetUrl;
  async ngOnInit() { await this.load(); }
  async load() {
    this.loading.set(true); this.error.set('');
    try { this.albums.set(await this.api.request<Album[]>('albums')); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.loading.set(false); }
  }
}

interface UploadItem { file: File; progress: number; status: 'waiting' | 'uploading' | 'done' | 'error'; error: string }

@Component({
  standalone: true, imports: [RouterLink, FormsModule, DatePipe, Icon], templateUrl: './album.html',
})
export class AlbumPage implements OnInit, OnDestroy {
  private api = inject(Api); private route = inject(ActivatedRoute); private router = inject(Router);
  album = signal<Album | null>(null); loading = signal(true); error = signal(''); notice = signal('');
  busy = signal(false); uploading = signal(false); dragging = signal(false);
  queue = signal<UploadItem[]>([]); lightboxIndex = signal(-1);
  name = ''; description = ''; isNew = false; editing = false;
  private subscription?: { unsubscribe(): void };
  private lastFocus: HTMLElement | null = null;
  viewer = viewChild<ElementRef<HTMLDialogElement>>('viewer');
  confirmation = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  deleteTarget = signal<Photo | 'album' | null>(null);
  photos = computed(() => this.album()?.photos ?? []);
  activePhoto = computed(() => this.photos()[this.lightboxIndex()] ?? null);
  failed = computed(() => this.queue().some(item => item.status === 'error'));
  asset = assetUrl;

  ngOnInit() {
    this.subscription = this.route.paramMap.subscribe(async params => {
      const id = params.get('id');
      this.isNew = !id; this.editing = this.isNew || !!this.route.snapshot.data['edit'];
      this.loading.set(true); this.error.set(''); this.notice.set(''); this.queue.set([]);
      try {
        this.album.set(id ? await this.api.request<Album>(`albums/${id}`) : null);
        this.name = this.album()?.name ?? ''; this.description = this.album()?.description ?? '';
      } catch (e) { this.error.set((e as Error).message); }
      finally { this.loading.set(false); }
    });
  }
  ngOnDestroy() { this.subscription?.unsubscribe(); document.body.style.overflow = ''; }
  hasChanges() { return this.editing && (this.name !== (this.album()?.name ?? '') || this.description !== (this.album()?.description ?? '')); }
  canLeave() { return !this.uploading() && !this.busy() && (!this.hasChanges() || window.confirm('Discard your unsaved changes?')); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.uploading() || this.busy() || this.hasChanges()) { event.preventDefault(); event.returnValue = ''; }
  }

  async save() {
    if (this.busy() || !this.name.trim() || this.name.trim().length > 120 || this.description.length > 2000) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const album = await this.api.request<Album>(this.isNew ? 'albums' : `albums/${this.album()!.id}`, this.isNew ? 'POST' : 'PATCH', { name: this.name, description: this.description });
      this.album.set(album); this.name = album.name; this.description = album.description;
      this.busy.set(false);
      if (this.isNew) { this.isNew = false; await this.router.navigate(['/albums', album.id, 'edit']); }
      else this.notice.set('Album details saved.');
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  choose(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) void this.addFiles(Array.from(input.files));
    input.value = '';
  }
  drop(event: DragEvent) { event.preventDefault(); this.dragging.set(false); if (event.dataTransfer) void this.addFiles(Array.from(event.dataTransfer.files)); }
  async addFiles(files: File[]) {
    if (this.uploading() || this.busy() || !files.length) return;
    this.error.set(''); this.notice.set('');
    if (files.length > 20) { this.error.set('Choose up to 20 images at a time.'); return; }
    this.queue.set(files.map(file => {
      const error = !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? 'Use JPEG, PNG or WebP.' : file.size > 10 * 1024 * 1024 ? 'Image exceeds 10 MB.' : '';
      return { file, progress: 0, status: error ? 'error' : 'waiting', error };
    }));
    await this.runQueue();
  }
  async retry() { this.queue.update(items => items.map(i => i.status === 'error' ? { ...i, status: 'waiting', error: '', progress: 0 } : i)); await this.runQueue(); }
  private updateItem(index: number, patch: Partial<UploadItem>) { this.queue.update(items => items.map((item, i) => i === index ? { ...item, ...patch } : item)); }
  private async runQueue() {
    this.uploading.set(true);
    for (let i = 0; i < this.queue().length; i++) {
      const item = this.queue()[i]; if (item.status !== 'waiting') continue;
      this.updateItem(i, { status: 'uploading' });
      try {
        const photo = await this.api.upload(this.album()!.id, item.file, progress => this.updateItem(i, { progress }));
        this.album.update(a => a ? { ...a, photos: [...(a.photos ?? []), photo], photoCount: a.photoCount + 1 } : a);
        this.updateItem(i, { status: 'done', progress: 100 });
      } catch (e) { this.updateItem(i, { status: 'error', error: (e as Error).message }); }
    }
    this.uploading.set(false);
    this.notice.set(this.failed() ? 'Some images could not be added. Review the messages below.' : 'All images added. Your memories are right at home.');
  }
  askDelete(target: Photo | 'album') {
    this.deleteTarget.set(target); this.lastFocus = document.activeElement as HTMLElement;
    this.confirmation()?.nativeElement.showModal();
  }
  cancelDelete() { this.confirmation()?.nativeElement.close(); this.deleteTarget.set(null); this.lastFocus?.focus(); }
  async confirmDelete() {
    const target = this.deleteTarget(); if (!target || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try {
      await this.api.request(target === 'album' ? `albums/${this.album()!.id}` : `photos/${target.id}`, 'DELETE');
      this.cancelDelete(); this.busy.set(false);
      if (target === 'album') { this.editing = false; await this.router.navigate(['/']); }
      else {
        this.album.update(a => a ? { ...a, photos: a.photos!.filter(p => p.id !== target.id), photoCount: a.photoCount - 1 } : a);
        this.notice.set('Photo deleted.');
      }
    } catch (e) { this.cancelDelete(); this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  openPhoto(index: number) {
    this.lastFocus = document.activeElement as HTMLElement;
    this.lightboxIndex.set(index); this.viewer()?.nativeElement.showModal(); document.body.style.overflow = 'hidden';
  }
  closePhoto() { this.viewer()?.nativeElement.close(); this.lightboxIndex.set(-1); document.body.style.overflow = ''; this.lastFocus?.focus(); }
  step(delta: number) { this.lightboxIndex.update(i => (i + delta + this.photos().length) % this.photos().length); }
  @HostListener('document:keydown', ['$event']) key(event: KeyboardEvent) {
    if (this.lightboxIndex() < 0) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); this.step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.step(-1); }
  }
}

export const leaveAlbum = (page: AlbumPage) => page.canLeave();

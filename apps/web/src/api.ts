import { Injectable } from '@angular/core';

export interface Photo {
  id: string; albumId: string; name: string; mime: string; size: number;
  width: number; height: number; createdAt: string; thumbnailUrl: string; originalUrl: string;
}
export interface Album {
  id: string; name: string; description: string; createdAt: string; updatedAt: string;
  photoCount: number; coverUrl: string | null; photos?: Photo[];
}
export const assetUrl = (relative: string) => new URL(relative, document.baseURI).href;

@Injectable({ providedIn: 'root' })
export class Api {
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(assetUrl(`api/${path}`), {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(typeof data?.message === 'string' ? data.message : 'Something went wrong. Please try again.');
    }
    return response.status === 204 ? undefined as T : response.json();
  }

  upload(albumId: string, file: File, progress: (value: number) => void): Promise<Photo> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', assetUrl(`api/albums/${albumId}/photos`));
      xhr.timeout = 120_000;
      xhr.upload.onprogress = e => { if (e.lengthComputable) progress(Math.round(e.loaded / e.total * 100)); };
      xhr.onerror = () => reject(new Error('Upload interrupted. Check your connection and retry.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Please retry.'));
      xhr.onload = () => {
        let body;
        try { body = JSON.parse(xhr.responseText); } catch { body = null; }
        if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
        else reject(new Error(typeof body?.message === 'string' ? body.message : 'Upload failed. Please retry.'));
      };
      const form = new FormData(); form.append('file', file); xhr.send(form);
    });
  }
}

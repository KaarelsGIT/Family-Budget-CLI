import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { TranslationService } from '../i18n/translation.service';

interface LoginResponse {
  data: {
    id: number;
    username: string;
    authType: string;
    role: 'ADMIN' | 'PARENT' | 'CHILD';
    preferredLanguage: 'et' | 'en' | 'fi';
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly userIdStorageKey = 'family_budget_auth_user_id';
  private readonly tokenStorageKey = 'family_budget_auth_token';
  private readonly usernameStorageKey = 'family_budget_auth_username';
  private readonly roleStorageKey = 'family_budget_auth_role';

  private readonly authState = signal({
    id: localStorage.getItem(this.userIdStorageKey),
    token: localStorage.getItem(this.tokenStorageKey),
    username: localStorage.getItem(this.usernameStorageKey),
    role: localStorage.getItem(this.roleStorageKey)
  });

  readonly userId = computed(() => this.authState().id);
  readonly username = computed(() => this.authState().username);
  readonly role = computed(() => this.authState().role);
  private readonly i18n = inject(TranslationService);

  constructor(private readonly http: HttpClient) {}

  login(username: string, password: string): Observable<void> {
    const selectedLanguage = this.i18n.language();

    return this.http.post<LoginResponse>('/api/auth/login', { username, password }).pipe(
      tap((response) => {
        const token = this.createBasicToken(username, password);
        this.authState.set({
          id: String(response.data.id),
          token,
          username: response.data.username,
          role: response.data.role
        });

        localStorage.setItem(this.userIdStorageKey, String(response.data.id));
        localStorage.setItem(this.tokenStorageKey, token);
        localStorage.setItem(this.usernameStorageKey, response.data.username);
        localStorage.setItem(this.roleStorageKey, response.data.role);

        this.i18n.setLanguage(selectedLanguage);
        if (response.data.preferredLanguage !== selectedLanguage) {
          this.updatePreferredLanguage(selectedLanguage).subscribe({
            error: () => {
              // Keep the current UI language even if syncing it to the backend fails.
            }
          });
        }
      }),
      map(() => void 0),
      catchError((error: HttpErrorResponse) => {
        const message = error.error?.message || this.i18n.translate('login.failed');
        return throwError(() => new Error(message));
      })
    );
  }

  isLoggedIn(): boolean {
    return !!this.authState().token && !!this.authState().username;
  }

  getUsername(): string | null {
    return this.authState().username;
  }

  getUserId(): number | null {
    const id = this.authState().id;
    return id ? Number(id) : null;
  }

  getRole(): string | null {
    return this.authState().role;
  }

  isAdmin(): boolean {
    return this.authState().role === 'ADMIN';
  }

  getToken(): string | null {
    return this.authState().token;
  }

  updateCredentials(username: string, password: string): void {
    const token = this.createBasicToken(username, password);
    this.authState.update((state) => ({
      ...state,
      username,
      token
    }));

    localStorage.setItem(this.usernameStorageKey, username);
    localStorage.setItem(this.tokenStorageKey, token);
  }

  updateUsername(username: string): void {
    const token = this.authState().token;
    if (!token?.startsWith('Basic ')) {
      this.authState.update((state) => ({ ...state, username }));
      localStorage.setItem(this.usernameStorageKey, username);
      return;
    }

    const decoded = atob(token.slice(6));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
      this.authState.update((state) => ({ ...state, username }));
      localStorage.setItem(this.usernameStorageKey, username);
      return;
    }

    const password = decoded.slice(separatorIndex + 1);
    this.updateCredentials(username, password);
  }

  updatePreferredLanguage(language: 'et' | 'en' | 'fi'): Observable<void> {
    const userId = this.getUserId();
    if (!userId) {
      return throwError(() => new Error('User not found'));
    }

    return this.http.put(`/api/users/${userId}`, { preferredLanguage: language }).pipe(
      map(() => void 0)
    );
  }

  logout(): void {
    localStorage.removeItem(this.userIdStorageKey);
    localStorage.removeItem(this.tokenStorageKey);
    localStorage.removeItem(this.usernameStorageKey);
    localStorage.removeItem(this.roleStorageKey);
    this.authState.set({ id: null, token: null, username: null, role: null });
  }

  private createBasicToken(username: string, password: string): string {
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
}

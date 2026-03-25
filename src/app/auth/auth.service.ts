import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';

interface LoginResponse {
  data: {
    username: string;
    authType: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly tokenStorageKey = 'family_budget_auth_token';
  private readonly usernameStorageKey = 'family_budget_auth_username';

  private readonly authState = signal({
    token: localStorage.getItem(this.tokenStorageKey),
    username: localStorage.getItem(this.usernameStorageKey)
  });

  readonly username = computed(() => this.authState().username);

  constructor(private readonly http: HttpClient) {}

  login(username: string, password: string): Observable<void> {
    return this.http.post<LoginResponse>('/api/auth/login', { username, password }).pipe(
      tap((response) => {
        const token = this.createBasicToken(username, password);
        this.authState.set({
          token,
          username: response.data.username
        });

        localStorage.setItem(this.tokenStorageKey, token);
        localStorage.setItem(this.usernameStorageKey, response.data.username);
      }),
      map(() => void 0),
      catchError((error: HttpErrorResponse) => {
        const message = error.error?.message || 'Login failed. Please check your username and password.';
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

  getToken(): string | null {
    return this.authState().token;
  }

  logout(): void {
    localStorage.removeItem(this.tokenStorageKey);
    localStorage.removeItem(this.usernameStorageKey);
    this.authState.set({ token: null, username: null });
  }

  private createBasicToken(username: string, password: string): string {
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
}

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  if (!token || !request.url.startsWith('/api/')) {
    return next(request);
  }

  return next(request.clone({
    setHeaders: {
      Authorization: token
    }
  })).pipe(
    catchError((error: HttpErrorResponse) => {
      console.log('API error status', error.status, request.url);

      if (error.status === 401 && request.url.startsWith('/api/')) {
        authService.logout();
        router.navigateByUrl('/');
      }

      if (error.status === 403 && request.url.startsWith('/api/')) {
        console.error('Access denied', request.url);
      }

      return throwError(() => error);
    })
  );
};

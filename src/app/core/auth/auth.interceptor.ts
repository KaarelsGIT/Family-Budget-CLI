import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  if (!token || !request.url.startsWith(environment.apiUrl)) {
    return next(request);
  }

  return next(request.clone({
    setHeaders: {
      Authorization: token
    }
  })).pipe(
    catchError((error: HttpErrorResponse) => {
      console.log('API error status', error.status, request.url);

      if (error.status === 401 && request.url.startsWith(environment.apiUrl)) {
        authService.logout();
        router.navigateByUrl('/');
      }

      if (error.status === 403 && request.url.startsWith(environment.apiUrl)) {
        console.error('Access denied', request.url);
      }

      return throwError(() => error);
    })
  );
};

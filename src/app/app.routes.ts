import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { AccountsComponent } from './accounts/accounts';
import { Home } from './home/home';
import { User } from './user/user';

export const routes: Routes = [
  {
    path: '',
    component: Home
  },
  {
    path: 'account-settings',
    component: User,
    canActivate: [authGuard]
  },
  {
    path: 'accounts',
    component: AccountsComponent,
    canActivate: [authGuard]
  },
  {
    path: 'user',
    redirectTo: 'account-settings',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];

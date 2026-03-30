import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { AccountsPageComponent } from './features/accounts/pages/accounts-page/accounts-page.component';
import { TransactionsPageComponent } from './features/transactions/pages/transactions-page/transactions-page.component';
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
    component: AccountsPageComponent,
    canActivate: [authGuard]
  },
  {
    path: 'transactions',
    component: TransactionsPageComponent,
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

import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { AccountsPageComponent } from './features/accounts/pages/accounts-page/accounts-page.component';
import { CategoryManagementPageComponent } from './features/categories/pages/category-management-page/category-management-page.component';
import { StatisticsPageComponent } from './features/statistics/pages/statistics-page/statistics-page.component';
import { RecurringPaymentsPageComponent } from './features/transactions/pages/recurring-payments-page/recurring-payments-page.component';
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
    path: 'settings/categories',
    component: CategoryManagementPageComponent,
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
    path: 'statistics',
    component: StatisticsPageComponent,
    canActivate: [authGuard]
  },
  {
    path: 'transactions/recurring',
    component: RecurringPaymentsPageComponent,
    canActivate: [authGuard]
  },
  {
    path: 'user',
    redirectTo: 'account-settings',
    pathMatch: 'full'
  },
  {
    path: 'settings',
    redirectTo: 'settings/categories',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];

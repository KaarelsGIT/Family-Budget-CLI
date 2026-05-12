import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface YearlyStatisticsResponse {
  year: number;
  totals: YearlyStatisticsTotals;
  monthly: YearlyStatisticsMonthlyEntry[];
  categories: YearlyStatisticsCategories;
  accounts: YearlyStatisticsAccountEntry[];
  transfers: YearlyStatisticsTransfers;
}

export interface YearlyStatisticsTotals {
  income: number;
  expenses: number;
  net: number;
  savings: number;
  savingsRateYear: number;
}

export interface YearlyStatisticsMonthlyEntry {
  month: number;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}

export interface YearlyStatisticsCategoryEntry {
  parentCategory: string;
  total: number;
  monthly: Record<string, number>;
  subcategories: YearlyStatisticsSubcategoryEntry[];
}

export interface YearlyStatisticsSubcategoryEntry {
  name: string;
  total: number;
  monthly: Record<string, number>;
}

export interface YearlyStatisticsCategories {
  income: YearlyStatisticsCategoryEntry[];
  expenses: YearlyStatisticsCategoryEntry[];
}

export interface YearlyStatisticsAccountEntry {
  accountId: number;
  name: string;
  income: number;
  expenses: number;
  balanceChange: number;
}

export interface YearlyStatisticsTransfers {
  totalAmount: number;
  count: number;
  monthly: YearlyStatisticsTransferMonthEntry[];
}

export interface YearlyStatisticsTransferMonthEntry {
  month: number;
  totalAmount: number;
  count: number;
}

@Injectable({
  providedIn: 'root'
})
export class StatisticsService {
  private readonly http = inject(HttpClient);

  getYearly(
    year: number,
    month: number | null,
    userId: number | null,
    userType: 'PARENT' | 'CHILD' | null,
    accountId: number | null
  ): Observable<YearlyStatisticsResponse> {
    let params = new HttpParams().set('year', year);
    if (month !== null) {
      params = params.set('month', month);
    }
    if (userId !== null) {
      params = params.set('user_id', userId);
    }
    if (userType !== null) {
      params = params.set('userType', userType);
    }
    if (accountId !== null) {
      params = params.set('account_id', accountId);
    }

    return this.http.get<YearlyStatisticsResponse>(`${environment.apiUrl}/statistics/yearly`, { params });
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalaryCalculatorModal } from './salary-calculator-modal';

describe('SalaryCalculatorModal', () => {
  let component: SalaryCalculatorModal;
  let fixture: ComponentFixture<SalaryCalculatorModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalaryCalculatorModal],
    }).compileComponents();

    fixture = TestBed.createComponent(SalaryCalculatorModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

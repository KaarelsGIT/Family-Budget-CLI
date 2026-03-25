import {Component, EventEmitter, HostListener, Input, Output} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {NgIf, NgStyle} from '@angular/common';

@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [FormsModule, NgIf, NgStyle],
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.css']
})
export class CalculatorComponent {
  @Input() isVisible = false;
  @Output() closeCalculator = new EventEmitter<void>();

  display: string = '0';
  expression: string = '';
  private tokens: string[] = [];
  waitingForSecondOperand: boolean = false;
  private hasResult = false;

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (!this.isVisible) return;

    event.preventDefault();

    const key = event.key;

    if (/^[0-9.]$/.test(key)) {
      this.appendNumber(key);
      return;
    }

    switch (key) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
        this.appendOperator(key);
        break;
      case 'Enter':
      case '=':
        this.calculate();
        break;
      case 'Backspace':
        this.delete();
        break;
      case 'Escape':
        this.close();
        break;
      case 'c':
      case 'C':
        this.clear();
        break;
    }
  }

  appendNumber(num: string): void {
    if (this.hasResult) {
      this.clear();
      this.hasResult = false;
    }

    if (this.waitingForSecondOperand) {
      this.display = num === '.' ? '0.' : num;
      this.waitingForSecondOperand = false;
    } else {
      if (num === '.') {
        if (!this.display.includes('.')) {
          this.display += num;
        }
      } else {
        this.display = this.display === '0' ? num : this.display + num;
      }
    }
    this.updateExpressionFromDisplay();
  }

  private updateExpressionFromDisplay(): void {
    const lastTokenIndex = this.tokens.length - 1;
    const lastToken = this.tokens[lastTokenIndex];

    if (this.tokens.length === 0 || this.isOperator(lastToken)) {
      this.expression = this.tokens.join(' ') + (this.tokens.length > 0 ? ' ' : '') + this.display;
    } else {
      // Replacing the last number token (or percent token)
      const newTokens = [...this.tokens];
      newTokens[lastTokenIndex] = this.display;
      this.expression = newTokens.join(' ');
    }
  }

  private isOperator(token: string): boolean {
    return ['+', '-', '*', '/'].includes(token);
  }

  appendOperator(op: string): void {
    if (this.hasResult) {
      const result = this.display;
      this.clear();
      this.display = result;
      this.hasResult = false;
    }

    if (op === '%') {
      this.handlePercent();
      return;
    }

    if (this.waitingForSecondOperand && this.tokens.length > 0) {
      // Replace last operator
      this.tokens[this.tokens.length - 1] = op;
    } else {
      this.tokens.push(this.display);
      this.tokens.push(op);
    }

    this.waitingForSecondOperand = true;
    this.expression = this.tokens.join(' ');
  }

  handlePercent(): void {
    if (this.hasResult) {
      const result = this.display;
      this.clear();
      this.display = result;
      this.hasResult = false;
    }

    const value = parseFloat(this.display);
    let percentValue: number;

    const lastOp = this.tokens[this.tokens.length - 1];
    if (this.tokens.length >= 2 && (lastOp === '+' || lastOp === '-')) {
      // For addition/subtraction, percent is based on the first term of the expression (simplified logic)
      // or more accurately, the base value it's being added to.
      // Let's find the base value.
      const baseValue = this.evaluateTokens(this.tokens.slice(0, -1));
      percentValue = (baseValue * value) / 100;
    } else {
      percentValue = value / 100;
    }

    this.display = String(Number(percentValue.toFixed(10)));
    this.waitingForSecondOperand = false;

    // Add percent to expression display
    if (this.tokens.length > 0 && !this.isOperator(this.tokens[this.tokens.length - 1])) {
       // Should not happen with current logic as we push display then operator
    }
    this.expression = this.tokens.join(' ') + (this.tokens.length > 0 ? ' ' : '') + value + '%';
  }

  calculate(): void {
    if (this.hasResult || this.tokens.length === 0) return;

    this.tokens.push(this.display);
    const result = this.evaluateTokens(this.tokens);

    this.expression += ' = ';
    this.display = String(Number(result.toFixed(10)));
    this.tokens = [];
    this.waitingForSecondOperand = false;
    this.hasResult = true;
  }

  private evaluateTokens(tokens: string[]): number {
    if (tokens.length === 0) return 0;

    // Process * and / first (Precedence)
    let tempTokens: (number | string)[] = [];
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token === '*' || token === '/') {
        const prev = tempTokens.pop() as number;
        const next = parseFloat(tokens[i + 1]);
        const result = token === '*' ? prev * next : prev / next;
        tempTokens.push(result);
        i += 2;
      } else {
        const val = parseFloat(token);
        tempTokens.push(isNaN(val) ? token : val);
        i++;
      }
    }

    // Process + and -
    let result = tempTokens[0] as number;
    let j = 1;
    while (j < tempTokens.length) {
      const op = tempTokens[j] as string;
      const next = tempTokens[j + 1] as number;
      if (op === '+') result += next;
      if (op === '-') result -= next;
      j += 2;
    }

    return result;
  }

  clear(): void {
    this.display = '0';
    this.expression = '';
    this.tokens = [];
    this.waitingForSecondOperand = false;
    this.hasResult = false;
  }

  delete(): void {
    if (this.hasResult) {
      this.clear();
      return;
    }

    if (this.display.length > 1) {
      this.display = this.display.slice(0, -1);
    } else {
      this.display = '0';
    }
    this.updateExpressionFromDisplay();
  }

  close(): void {
    this.closeCalculator.emit();
  }

  @HostListener('document:mousemove', ['$event'])
  handleMouseMove(event: MouseEvent) {
    this.onMouseMove(event);
  }

  @HostListener('document:mouseup')
  handleMouseUp() {
    this.onMouseUp();
  }


  dragging = false;
  offsetX = 0;
  offsetY = 0;
  position = { top: 100, left: 100 };

  onMouseDown(event: MouseEvent): void {
    this.dragging = true;
    this.offsetX = event.clientX - this.position.left;
    this.offsetY = event.clientY - this.position.top;
  }

  onMouseMove(event: MouseEvent): void {
    if (this.dragging) {
      this.position.left = event.clientX - this.offsetX;
      this.position.top = event.clientY - this.offsetY;
    }
  }

  onMouseUp(): void {
    this.dragging = false;
  }
}

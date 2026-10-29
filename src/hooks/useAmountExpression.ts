import { useCallback, useState } from 'react';
import {
  AmountExpressionState,
  createExpression,
  getExpressionDisplay,
  getExpressionTotal,
  isMultiTerm,
  pressBackspace,
  pressBackspaceAtIndex,
  pressDigit,
  pressDigitAtIndex,
  pressDot,
  pressDotAtIndex,
  pressOperator,
} from '../utils/amountExpression';

interface UseAmountExpressionResult {
  displayValue: string;   // 顶部金额展示，按实际按键原样显示（"5"、"5.50"），空态 "0"
  isMulti: boolean;       // 是否有多项（拆分金额中），可用来给展示文字调小字号
  pressKey: (key: string) => void; // 传入 '0'-'9' / '.' / '+' / '-' / 'backspace'
  /** 光标模式按键：cursorFromEnd = 光标距显示串尾部的偏移（0 = 最末尾）。返回新光标偏移 */
  pressKeyAt: (key: string, cursorFromEnd: number) => number;
  total: number;        // 当前算式的实时结果（仅读取，不重置键盘状态）
  confirm: () => number;  // 返回求值结果，同时重置键盘状态
  reset: (value?: number | string) => void;
}

export function useAmountExpression(initialValue?: number | string): UseAmountExpressionResult {
  const [state, setState] = useState<AmountExpressionState>(() => createExpression(initialValue));

  const pressKey = useCallback((key: string) => {
    setState((prev) => {
      if (key === 'backspace') return pressBackspace(prev);
      if (key === '+' || key === '-') return pressOperator(prev, key);
      if (key === '.') return pressDot(prev); // 小数点由用户显式输入，一项最多一个
      return pressDigit(prev, key);
    });
  }, []);

  const confirm = useCallback(() => {
    const total = getExpressionTotal(state);
    setState(createExpression(total));
    return total;
  }, [state]);

  // 光标模式按键：数字/小数点/退格在光标位置生效；+/- 回到末尾。
  // 用闭包里的 state 计算（deps 带 state），同步返回新光标偏移给调用方
  const pressKeyAt = useCallback(
    (key: string, cursorFromEnd: number): number => {
      if (key === 'backspace') {
        const r = pressBackspaceAtIndex(state, cursorFromEnd);
        setState(r.state);
        return r.cursorFromEnd;
      }
      if (key === '+' || key === '-') {
        setState(pressOperator(state, key));
        return 0;
      }
      if (key === '.') {
        const r = pressDotAtIndex(state, cursorFromEnd);
        setState(r.state);
        return r.cursorFromEnd;
      }
      const r = pressDigitAtIndex(state, key, cursorFromEnd);
      setState(r.state);
      return r.cursorFromEnd;
    },
    [state]
  );

  const reset = useCallback((value?: number | string) => {
    setState(createExpression(value));
  }, []);

  return {
    displayValue: getExpressionDisplay(state),
    total: getExpressionTotal(state),
    isMulti: isMultiTerm(state),
    pressKey,
    pressKeyAt,
    confirm,
    reset,
  };
}

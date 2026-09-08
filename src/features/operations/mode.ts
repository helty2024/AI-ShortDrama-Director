import { createContext, useContext } from 'react'
export const SimpleModeContext = createContext(true)
export function useSimpleMode() {
  return useContext(SimpleModeContext)
}

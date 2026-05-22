import { useNavigate } from 'react-router-dom'
import { pageToPath, type PageKey } from '../appPaths'

export function useAppNavigate() {
  const navigate = useNavigate()
  return (page: PageKey) => navigate(pageToPath(page))
}

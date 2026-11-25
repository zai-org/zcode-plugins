import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import { ForensicHud } from '@/components/ForensicHud'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      <ForensicHud />
    </>
  )
}

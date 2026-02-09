import { Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { Arcade } from './pages/Arcade'
import { NameThatTune } from './pages/arcade/NameThatTune'
import { DiscoRoom } from './pages/arcade/DiscoRoom'
import { SpotifySuccess } from './pages/arcade/SpotifySuccess'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/arcade" element={<Arcade />} />
      <Route path="/arcade/spotify-success" element={<SpotifySuccess />} />
      <Route path="/arcade/name-that-tune" element={<NameThatTune />} />
      <Route path="/arcade/spotify-full" element={<DiscoRoom />} />
    </Routes>
  )
}

export default App

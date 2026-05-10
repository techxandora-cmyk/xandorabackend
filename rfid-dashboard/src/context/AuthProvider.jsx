import { useEffect, useState } from "react";
import { AuthContext } from "./AuthContext";

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem("xandora_jwt");
    const u = localStorage.getItem("xandora_user");
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
    }
    setLoading(false);
  }, []);

  function setAuth(user, token) {
    setUser(user);
    setToken(token);
    localStorage.setItem("xandora_jwt", token);
    localStorage.setItem("xandora_user", JSON.stringify(user));
  }

  function logout() {
    setUser(null);
    setToken(null);
    localStorage.clear();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        isAdmin: user?.role === "GLOBAL_ADMIN",
        store_ids: user?.store_ids || ["STORE_001"],
        setAuth,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

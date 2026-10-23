package com.jishiben.api.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiError;
import com.jishiben.api.common.ErrorCode;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Turns "Authorization: Bearer <access token>" into an authentication, rejecting stale tokens whose
 * version no longer matches users.token_version. A request without the header stays anonymous and
 * is then refused by the authorization rules.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final JwtService jwtService;
    private final TokenVersionSource tokenVersions;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationFilter(JwtService jwtService, TokenVersionSource tokenVersions,
                                   ObjectMapper objectMapper) {
        this.jwtService = jwtService;
        this.tokenVersions = tokenVersions;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, BEARER, 0, BEARER.length())) {
            chain.doFilter(request, response);
            return;
        }
        String token = header.substring(BEARER.length()).trim();
        try {
            Claims claims = jwtService.parseAccess(token);
            AuthPrincipal principal = jwtService.principal(claims);
            if (tokenVersions.currentVersion(principal.id()) != principal.tokenVersion()) {
                reject(request, response, ErrorCode.TOKEN_REVOKED,
                        "This session has been revoked; sign in again");
                return;
            }
            UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                    principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + principal.role())));
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (ExpiredJwtException ex) {
            reject(request, response, ErrorCode.TOKEN_EXPIRED, "Access token has expired");
            return;
        } catch (JwtException | IllegalArgumentException ex) {
            reject(request, response, ErrorCode.TOKEN_INVALID, "Access token is not valid");
            return;
        }
        chain.doFilter(request, response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response, ErrorCode code,
                        String message) throws IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        objectMapper.writeValue(response.getOutputStream(), ApiError.of(
                code, HttpStatus.UNAUTHORIZED.value(), message, request.getRequestURI()));
    }
}

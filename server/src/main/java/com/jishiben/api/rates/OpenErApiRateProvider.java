package com.jishiben.api.rates;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiException;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Fetches open.er-api.com/v6/latest/{base}. The host is a constant, the base currency is validated
 * as three uppercase letters and redirects are never followed, so nothing the caller sends can steer
 * the request at another host (SSRF).
 */
@Component
public class OpenErApiRateProvider implements RateProvider {

    private static final Pattern ISO_CODE = Pattern.compile("^[A-Z]{3}$");

    private final RestClient client;
    private final ObjectMapper objectMapper;

    public OpenErApiRateProvider(ObjectMapper objectMapper,
                                 @Value("${app.rates.base-url:https://open.er-api.com/v6/latest}") String baseUrl,
                                 @Value("${app.rates.connect-timeout-ms:5000}") int connectTimeoutMs,
                                 @Value("${app.rates.read-timeout-ms:8000}") int readTimeoutMs) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.client = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
        this.objectMapper = objectMapper;
    }

    @Override
    public JsonNode fetchRates(String base) {
        if (base == null || !ISO_CODE.matcher(base).matches()) {
            throw ApiException.validation("base must be a 3-letter ISO-4217 currency code");
        }
        String body;
        try {
            body = client.get()
                    .uri("/{base}", base)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException ex) {
            throw ApiException.upstream("The reference rate provider is unavailable");
        }
        if (body == null || body.isBlank()) {
            throw ApiException.upstream("The reference rate provider returned an empty response");
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode rates = root.path("rates");
            if (!rates.isObject() || rates.isEmpty()) {
                throw ApiException.upstream("The reference rate provider returned an unexpected payload");
            }
            return rates;
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw ApiException.upstream("The reference rate provider returned an unreadable payload");
        }
    }
}
